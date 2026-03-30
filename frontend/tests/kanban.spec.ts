import { expect, test, type Page } from "@playwright/test";

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

const mockApi = async (page: Page, boardState: { value: ReturnType<typeof createBoard> }) => {
  await page.route("**/api/board", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(boardState.value),
      });
      return;
    }

    if (method === "PUT") {
      boardState.value = route.request().postDataJSON() as ReturnType<typeof createBoard>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({ status: 405 });
  });

  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant_message: "AI response",
        board_updated: false,
        board: boardState.value,
      }),
    });
  });
};

test("loads the kanban board from API", async ({ page }) => {
  const boardState = { value: createBoard() };
  await mockApi(page, boardState);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  await expect(page.getByLabel("Column title").first()).toHaveValue("Backlog");
});

test("adds a card to a column", async ({ page }) => {
  const boardState = { value: createBoard() };
  await mockApi(page, boardState);

  await page.goto("/");
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();
});

test("persists board changes across reload", async ({ page }) => {
  const boardState = { value: createBoard() };
  let putCount = 0;
  await page.route("**/api/board", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(boardState.value),
      });
      return;
    }
    if (method === "PUT") {
      putCount += 1;
      boardState.value = route.request().postDataJSON() as ReturnType<typeof createBoard>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.fulfill({ status: 405 });
  });
  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/");
  const firstColumnInput = page.getByLabel("Column title").first();
  await firstColumnInput.fill("Persisted Column");
  await expect(firstColumnInput).toHaveValue("Persisted Column");
  await expect.poll(() => putCount).toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByLabel("Column title").first()).toHaveValue("Persisted Column");
});

test("keeps board state isolated per authenticated session", async ({ browser }) => {
  const sessionABoard = { value: createBoard() };
  const sessionBBoard = { value: createBoard() };
  sessionABoard.value.columns[0].title = "Session A";
  sessionBBoard.value.columns[0].title = "Session B";

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await mockApi(pageA, sessionABoard);
  await mockApi(pageB, sessionBBoard);

  await pageA.goto("/");
  await pageB.goto("/");

  await expect(pageA.getByLabel("Column title").first()).toHaveValue("Session A");
  await expect(pageB.getByLabel("Column title").first()).toHaveValue("Session B");

  await contextA.close();
  await contextB.close();
});

test("renders AI chat reply in sidebar", async ({ page }) => {
  const boardState = { value: createBoard() };
  await mockApi(page, boardState);

  await page.goto("/");
  await page.getByLabel("Message").fill("Hello AI");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("AI response")).toBeVisible();
});

test("applies AI-proposed board mutation automatically", async ({ page }) => {
  const boardState = { value: createBoard() };
  await page.route("**/api/board", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(boardState.value),
      });
      return;
    }
    if (method === "PUT") {
      boardState.value = route.request().postDataJSON() as ReturnType<typeof createBoard>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.fulfill({ status: 405 });
  });
  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/api/ai/chat", async (route) => {
    const mutated = createBoard();
    mutated.columns[0].title = "AI Updated Column";
    boardState.value = mutated;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant_message: "I updated your board.",
        board_updated: true,
        board: mutated,
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("Message").fill("Rename first column");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel("Column title").first()).toHaveValue("AI Updated Column");
});
