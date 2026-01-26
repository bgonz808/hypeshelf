import type { ReactNode } from "react";

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Section({
  title,
  description,
  children,
  className = "",
}: SectionProps) {
  return (
    <section
      className={`mb-12 ${className}`}
      aria-labelledby={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <header className="mb-6">
        <h2
          id={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}
          className="text-primary text-2xl font-bold"
        >
          {title}
        </h2>
        {description && (
          <p className="text-secondary mt-1 text-sm">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}
