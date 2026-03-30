import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { KanbanBoard } from "@/components/KanbanBoard";

const createBoard = () => ({
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    { id: "col-progress", title: "In Progress", cardIds: ["card-4", "card-5"] },
    { id: "col-review", title: "Review", cardIds: ["card-6"] },
    { id: "col-done", title: "Done", cardIds: ["card-7", "card-8"] },
  ],
  cards: {
    "card-1": {
      id: "card-1",
      title: "Align roadmap themes",
      details: "Draft quarterly themes with impact statements and metrics.",
    },
    "card-2": {
      id: "card-2",
      title: "Gather customer signals",
      details: "Review support tags, sales notes, and churn feedback.",
    },
    "card-3": {
      id: "card-3",
      title: "Prototype analytics view",
      details: "Sketch initial dashboard layout and key drill-downs.",
    },
    "card-4": {
      id: "card-4",
      title: "Refine status language",
      details: "Standardize column labels and tone across the board.",
    },
    "card-5": {
      id: "card-5",
      title: "Design card layout",
      details: "Add hierarchy and spacing for scanning dense lists.",
    },
    "card-6": {
      id: "card-6",
      title: "QA micro-interactions",
      details: "Verify hover, focus, and loading states.",
    },
    "card-7": {
      id: "card-7",
      title: "Ship marketing page",
      details: "Final copy approved and asset pack delivered.",
    },
    "card-8": {
      id: "card-8",
      title: "Close onboarding sprint",
      details: "Document release notes and share internally.",
    },
  },
});

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];

describe("KanbanBoard", () => {
  const serverBoard = createBoard();
  serverBoard.columns[0].title = "Server Backlog";
  const putPayloads: unknown[] = [];
  let chatResponse: {
    assistant_message: string;
    board_updated: boolean;
    board: ReturnType<typeof createBoard>;
  };

  beforeEach(() => {
    putPayloads.length = 0;
    chatResponse = {
      assistant_message: "Done. I updated the board.",
      board_updated: false,
      board: createBoard(),
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url === "/api/board" && method === "GET") {
          return new Response(JSON.stringify(serverBoard), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url === "/api/board" && method === "PUT") {
          putPayloads.push(JSON.parse(String(init?.body ?? "{}")));
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url === "/api/auth/logout" && method === "POST") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        if (url === "/api/ai/chat" && method === "POST") {
          return new Response(JSON.stringify(chatResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response("Not found", { status: 404 });
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads board data from /api/board", async () => {
    render(<KanbanBoard />);
    await waitFor(() => {
      expect(within(getFirstColumn()).getByLabelText("Column title")).toHaveValue(
        "Server Backlog"
      );
    });
  });

  it("renders five columns", async () => {
    render(<KanbanBoard />);
    await waitFor(() => {
      expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
    });
  });

  it("renames a column and persists via /api/board", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");

    await waitFor(() => {
      const hasNewName = putPayloads.some((payload) => {
        const data = payload as { columns: Array<{ title: string }> };
        return data.columns[0].title === "New Name";
      });
      expect(hasNewName).toBe(true);
    });
  });

  it("adds and removes a card", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();
    const addButton = within(column).getByRole("button", {
      name: /add a card/i,
    });
    await userEvent.click(addButton);

    const titleInput = within(column).getByPlaceholderText(/card title/i);
    await userEvent.type(titleInput, "New card");
    const detailsInput = within(column).getByPlaceholderText(/details/i);
    await userEvent.type(detailsInput, "Notes");

    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));
    expect(within(column).getByText("New card")).toBeInTheDocument();

    const deleteButton = within(column).getByRole("button", {
      name: /delete new card/i,
    });
    await userEvent.click(deleteButton);

    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
  });

  it("shows AI assistant response in chat", async () => {
    render(<KanbanBoard />);
    const input = screen.getByLabelText("Message");
    await userEvent.type(input, "Move card 1");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("Done. I updated the board.")).toBeInTheDocument();
    });
  });

  it("applies AI board mutation automatically", async () => {
    const mutated = createBoard();
    mutated.columns[0].title = "AI Renamed";
    chatResponse = {
      assistant_message: "Updated",
      board_updated: true,
      board: mutated,
    };

    render(<KanbanBoard />);
    const input = screen.getByLabelText("Message");
    await userEvent.type(input, "Rename first column");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(within(getFirstColumn()).getByLabelText("Column title")).toHaveValue(
        "AI Renamed"
      );
    });
  });
});
