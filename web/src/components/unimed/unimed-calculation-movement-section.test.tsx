import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_UNIMED_EXCLUSION_REASONS } from "@/lib/unimed/defaults";
import { UnimedCalculationMovementSection } from "./unimed-calculation-movement-section";
import { INITIAL_FORM } from "./unimed-calculation-utils";

type Control = {
  children?: ReactNode;
  id?: string;
  name?: string;
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
};

function control(root: ReactNode, matches: (props: Control) => boolean): Control {
  const pending = Children.toArray(root);
  while (pending.length) {
    const node = pending.shift();
    if (!isValidElement<Control>(node)) continue;
    if (matches(node.props)) return node.props;
    pending.push(...Children.toArray(node.props.children));
  }
  throw new Error("Expected form control was not rendered");
}

function props() {
  return {
    form: {
      ...INITIAL_FORM,
      reasonCode: "8",
      planEnrollmentDate: "2026-08-01",
      exclusionDate: "2026-09-17",
    },
    errors: {},
    reasons: DEFAULT_UNIMED_EXCLUSION_REASONS,
    updateForm: vi.fn(),
    updateExclusionDate: vi.fn(),
  };
}

describe("Unimed movement form contract", () => {
  it("preserves the selected document reason and constrains the date interval", () => {
    const html = renderToStaticMarkup(<UnimedCalculationMovementSection {...props()} />);
    expect(html).toMatch(/<option[^>]*value="8"[^>]*selected/);
    expect(html).toContain("Dispensa S/J");
    expect(html).toContain('max="2026-09-17"');
    expect(html).toContain('min="2026-08-01"');
    expect(html).toContain('for="unimed-reason"');
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("associates validation errors with each control without inventing date bounds", () => {
    const input = props();
    const html = renderToStaticMarkup(<UnimedCalculationMovementSection
      {...input}
      form={{ ...input.form, planEnrollmentDate: "", exclusionDate: "" }}
      errors={{
        reasonCode: "Selecione um motivo",
        planEnrollmentDate: "Informe a inclusão",
        exclusionDate: "Informe a exclusão",
      }}
    />);
    for (const field of ["reason", "enrollment", "exclusion"]) {
      expect(html).toContain(`aria-describedby="unimed-${field}-error"`);
      expect(html).toContain(`id="unimed-${field}-error"`);
    }
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(3);
    expect(html).not.toMatch(/\s(?:min|max)="/);
  });

  it("forwards reason, date and billing changes to their correct state handlers", () => {
    const input = props();
    const tree = UnimedCalculationMovementSection(input);
    control(tree, (item) => item.id === "unimed-reason")
      .onChange?.({ target: { value: "1" } });
    control(tree, (item) => item.id === "unimed-enrollment")
      .onChange?.({ target: { value: "2026-07-01" } });
    control(tree, (item) => item.id === "unimed-exclusion")
      .onChange?.({ target: { value: "2026-09-20" } });
    for (const value of ["OPEN", "AUTOMATIC_DAY_25"]) {
      control(tree, (item) => item.name === "billing-closure" && item.value === value)
        .onChange?.({ target: { value } });
    }
    expect(input.updateForm.mock.calls).toEqual([
      ["reasonCode", "1"],
      ["planEnrollmentDate", "2026-07-01"],
      ["billingClosure", "OPEN"],
      ["billingClosure", "AUTOMATIC_DAY_25"],
    ]);
    expect(input.updateExclusionDate).toHaveBeenCalledExactlyOnceWith("2026-09-20");
  });
});
