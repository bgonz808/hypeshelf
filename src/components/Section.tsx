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
          className="text-brand-900 dark:text-brand-100 text-2xl font-bold"
        >
          {title}
        </h2>
        {description && (
          <p className="text-brand-600 dark:text-brand-300 mt-1 text-sm">
            {description}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}
