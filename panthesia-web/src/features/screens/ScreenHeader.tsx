import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
export function ScreenHeader({
  title,
  back,
  backLabel = "返回",
  backDisabled = false,
  backSide = "left",
  children,
}: {
  title: string;
  back: () => void;
  backLabel?: string;
  backDisabled?: boolean;
  backSide?: "left" | "right";
  children?: ReactNode;
}) {
  return (
    <header
      className={`synthesia-library-header ${backSide === "right" ? "back-on-right" : ""}`}
    >
      <button
        className="synthesia-back"
        data-workspace-close
        disabled={backDisabled}
        onClick={back}
      >
        <ChevronLeft />
        {backLabel}
      </button>
      <h1 className="product-screen-title">{title}</h1>
      {children}
    </header>
  );
}
