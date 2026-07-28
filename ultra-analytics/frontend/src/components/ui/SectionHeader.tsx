import type { ReactNode } from "react";

interface Props {
  question: string;
  title: string;
  aside?: ReactNode;
}

/** Every section leads with the one question it answers, in muted eyebrow text,
 * then a clean title. This is the visual expression of "one question per page". */
export default function SectionHeader({ question, title, aside }: Props) {
  return (
    <div className="section-header">
      <div>
        <div className="section-header__q">{question}</div>
        <h2 className="section-header__title">{title}</h2>
      </div>
      {aside && <div className="section-header__aside">{aside}</div>}
    </div>
  );
}
