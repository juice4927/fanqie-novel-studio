// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seed } from "../src/lib/browser-demo";
import { StoryBiblePage } from "../src/pages/StoryBibleWorkspace";
import type { AppApi } from "../src/shared/types";

afterEach(cleanup);

describe("story bible form", () => {
  it("keeps unsaved edits when an unrelated reload replaces the project object", () => {
    const project = seed().projects[0];
    const api = {} as AppApi;
    const props = {
      api,
      reload: vi.fn(async () => undefined),
      notify: vi.fn(),
    };
    const { rerender } = render(<StoryBiblePage project={project} {...props} />);

    fireEvent.change(screen.getByLabelText("故事前提"), { target: { value: "未保存的契约修改" } });

    // 模拟写作台后台自动保存触发的 reload：新的 project 对象、新的 contract 内容。
    rerender(
      <StoryBiblePage
        project={{
          ...project,
          contract: { ...project.contract, version: project.contract.version + 1 },
        }}
        {...props}
      />,
    );

    expect((screen.getByLabelText("故事前提") as HTMLTextAreaElement).value).toBe("未保存的契约修改");
    expect(screen.getByRole("alert").textContent).toContain("服务器上的创作契约已更新");
  });

  it("adopts the server version when there are no local edits", () => {
    const project = seed().projects[0];
    const props = { api: {} as AppApi, reload: vi.fn(async () => undefined), notify: vi.fn() };
    const { rerender } = render(<StoryBiblePage project={project} {...props} />);

    rerender(
      <StoryBiblePage
        project={{
          ...project,
          contract: { ...project.contract, premise: "服务器上的新前提", version: project.contract.version + 1 },
        }}
        {...props}
      />,
    );

    expect((screen.getByLabelText("故事前提") as HTMLTextAreaElement).value).toBe("服务器上的新前提");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
