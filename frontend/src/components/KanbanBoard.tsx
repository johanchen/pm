"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { createId, initialData, moveCard, type BoardData } from "@/lib/kanban";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export const KanbanBoard = () => {
  const [board, setBoard] = useState<BoardData>(() => initialData);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "error">(
    "idle"
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Ask me to create, edit, or move cards and I will update the board when needed.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatState, setChatState] = useState<"idle" | "sending" | "error">(
    "idle"
  );
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHydratedRef = useRef(false);
  const hasLocalEditsRef = useRef(false);
  const latestBoardRef = useRef(board);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const persistBoard = useCallback(async (snapshot: BoardData) => {
    setSyncState("syncing");
    try {
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      if (!response.ok) {
        throw new Error("Unable to save board.");
      }
      hasLocalEditsRef.current = false;
      setSyncState("idle");
    } catch {
      setSyncState("error");
    }
  }, []);

  const schedulePersist = useCallback(
    (snapshot: BoardData) => {
      latestBoardRef.current = snapshot;
      hasLocalEditsRef.current = true;

      if (!isHydratedRef.current) {
        return;
      }

      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }

      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void persistBoard(latestBoardRef.current);
      }, 250);
    },
    [persistBoard]
  );

  const updateBoard = useCallback(
    (updater: (current: BoardData) => BoardData) => {
      setBoard((current) => {
        const next = updater(current);
        schedulePersist(next);
        return next;
      });
    },
    [schedulePersist]
  );

  useEffect(() => {
    let cancelled = false;

    const hydrateBoard = async () => {
      try {
        const response = await fetch("/api/board", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Unable to load board.");
        }
        const serverBoard = (await response.json()) as BoardData;
        if (!cancelled && !hasLocalEditsRef.current) {
          setBoard(serverBoard);
          latestBoardRef.current = serverBoard;
          setSyncState("idle");
        }
      } catch {
        if (!cancelled) {
          setSyncState("error");
        }
      } finally {
        isHydratedRef.current = true;
        if (!cancelled && hasLocalEditsRef.current) {
          void persistBoard(latestBoardRef.current);
        }
      }
    };

    void hydrateBoard();

    return () => {
      cancelled = true;
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [persistBoard]);

  const cardsById = useMemo(() => board.cards, [board.cards]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!over || active.id === over.id) {
      return;
    }

    updateBoard((current) => ({
      ...current,
      columns: moveCard(current.columns, active.id as string, over.id as string),
    }));
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    updateBoard((current) => ({
      ...current,
      columns: current.columns.map((column) =>
        column.id === columnId ? { ...column, title } : column
      ),
    }));
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    const id = createId("card");
    updateBoard((current) => ({
      ...current,
      cards: {
        ...current.cards,
        [id]: { id, title, details: details || "No details yet." },
      },
      columns: current.columns.map((column) =>
        column.id === columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      ),
    }));
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    updateBoard((current) => ({
      ...current,
      cards: Object.fromEntries(
        Object.entries(current.cards).filter(([id]) => id !== cardId)
      ),
      columns: current.columns.map((column) =>
        column.id === columnId
          ? {
              ...column,
              cardIds: column.cardIds.filter((id) => id !== cardId),
            }
          : column
      ),
    }));
  };

  const handleLogout = async () => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }

    if (hasLocalEditsRef.current) {
      await persistBoard(latestBoardRef.current);
    }

    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const handleSendChat = async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatState === "sending") {
      return;
    }

    const historyForApi = [...chatMessages];
    setChatInput("");
    setChatState("sending");
    setChatMessages((prev) => [...prev, { role: "user", content: prompt }]);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: prompt,
          conversation_history: historyForApi,
        }),
      });

      if (!response.ok) {
        throw new Error("AI chat request failed.");
      }

      const payload = (await response.json()) as {
        assistant_message: string;
        board_updated: boolean;
        board: BoardData;
      };

      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: payload.assistant_message },
      ]);

      if (payload.board_updated && payload.board) {
        setBoard(payload.board);
        latestBoardRef.current = payload.board;
        hasLocalEditsRef.current = false;
        setSyncState("idle");
      }

      setChatState("idle");
    } catch {
      setChatState("error");
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I could not complete that request right now. Please retry.",
        },
      ]);
    }
  };

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                Focus
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                One board. Five columns. Zero clutter.
              </p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
                {syncState === "syncing" && "Saving changes..."}
                {syncState === "idle" && "All changes saved"}
                {syncState === "error" && "Save failed"}
              </p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-4 rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
              >
                Log out
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <section className="grid gap-6 lg:grid-cols-5">
              {board.columns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  cards={column.cardIds.map((cardId) => board.cards[cardId])}
                  onRename={handleRenameColumn}
                  onAddCard={handleAddCard}
                  onDeleteCard={handleDeleteCard}
                />
              ))}
            </section>
            <DragOverlay>
              {activeCard ? (
                <div className="w-[260px]">
                  <KanbanCardPreview card={activeCard} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          <aside className="flex h-[760px] flex-col rounded-3xl border border-[var(--stroke)] bg-white/85 p-5 shadow-[var(--shadow)] backdrop-blur">
            <div className="border-b border-[var(--stroke)] pb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                AI Sidebar
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold text-[var(--navy-dark)]">
                Board Copilot
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
                Ask for edits in plain language. I can respond and update the board.
              </p>
            </div>

            <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
              {chatMessages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                    message.role === "assistant"
                      ? "border border-[var(--stroke)] bg-[var(--surface)] text-[var(--navy-dark)]"
                      : "bg-[var(--primary-blue)] text-white"
                  }`}
                >
                  {message.content}
                </div>
              ))}
            </div>

            <div className="mt-4 border-t border-[var(--stroke)] pt-4">
              <label
                htmlFor="ai-chat-input"
                className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]"
              >
                Message
              </label>
              <textarea
                id="ai-chat-input"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                rows={4}
                placeholder="Move card-1 to Review and summarize the change."
                className="w-full resize-none rounded-2xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--gray-text)]">
                  {chatState === "sending" && "Thinking..."}
                  {chatState === "idle" && "Ready"}
                  {chatState === "error" && "Error"}
                </p>
                <button
                  type="button"
                  onClick={handleSendChat}
                  disabled={chatState === "sending" || !chatInput.trim()}
                  className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};
