"use client";

import { RotateCcw } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

export function PdfWorkspaceResetBoundary({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);

  function reset() {
    const url = new URL(window.location.href);
    url.searchParams.delete("job");
    window.history.replaceState(window.history.state, "", url);
    setVersion((current) => current + 1);
  }

  return (
    <>
      <div className="flex justify-end px-4 pt-4">
        <button type="button" className="pdf-secondary-button" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Limpar trabalho
        </button>
      </div>
      <Fragment key={version}>{children}</Fragment>
    </>
  );
}
