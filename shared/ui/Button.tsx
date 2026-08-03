import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  dark?: boolean;
  children: ReactNode;
}

const lightVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent/90 shadow-sm",
  secondary: "bg-white text-ink ring-1 ring-line/80 hover:ring-accent/30 hover:bg-canvas/50",
  ghost: "text-ink/80 hover:bg-black/[0.04]",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

const darkVariants: Record<ButtonVariant, string> = {
  primary: "bg-emerald-500 text-black hover:bg-emerald-400",
  secondary: "bg-white/8 text-white ring-1 ring-white/15 hover:bg-white/12",
  ghost: "text-white/75 hover:bg-white/8",
  danger: "bg-red-500/90 text-white hover:bg-red-500",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-[36px] px-3 text-xs",
  md: "min-h-[44px] px-4 text-sm",
  lg: "min-h-[52px] px-5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  dark = false,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${dark ? darkVariants[variant] : lightVariants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
