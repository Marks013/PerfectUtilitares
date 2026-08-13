import { CheckCircle2 } from "lucide-react";

type GuideSection = {
  title: string;
  text: string;
};

type PublicToolGuideProps = {
  title: string;
  introduction: string;
  sections: GuideSection[];
  tips: string[];
};

export function PublicToolGuide({
  title,
  introduction,
  sections,
  tips,
}: PublicToolGuideProps) {
  return (
    <section
      className="mt-10 border-t border-[color:var(--app-border)] pt-8"
      aria-labelledby="tool-guide-title"
    >
      <div className="max-w-4xl">
        <p className="app-kicker">Guia rápido</p>
        <h2
          id="tool-guide-title"
          className="mt-2 text-xl font-black text-[color:var(--app-fg)] sm:text-2xl"
        >
          {title}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-[color:var(--app-muted)]">
          {introduction}
        </p>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-3">
        {sections.map((section) => (
          <article key={section.title} className="min-w-0">
            <h3 className="text-sm font-extrabold text-[color:var(--app-fg)]">
              {section.title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[color:var(--app-muted)]">
              {section.text}
            </p>
          </article>
        ))}
      </div>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {tips.map((tip) => (
          <li
            key={tip}
            className="flex items-start gap-2 text-sm leading-6 text-[color:var(--app-muted)]"
          >
            <CheckCircle2
              className="mt-1 size-4 shrink-0 text-[color:var(--app-teal)]"
              aria-hidden="true"
            />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
