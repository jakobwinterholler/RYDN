import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  dark?: boolean;
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  children: ReactNode;
}

const paddingMap = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export function Card({
  dark = false,
  interactive = false,
  padding = "md",
  className = "",
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={`rounded-2xl ${paddingMap[padding]} ${
        dark
          ? "bg-white/[0.03] ring-1 ring-white/10"
          : "bg-card shadow-card ring-1 ring-black/[0.04]"
      } ${interactive ? "urp-card-hover cursor-pointer" : ""} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
