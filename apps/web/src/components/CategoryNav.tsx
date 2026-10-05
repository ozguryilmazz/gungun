import Link from "next/link";
import { CATEGORIES } from "@gundemci/shared";
import styles from "./CategoryNav.module.css";

/** Kategori bağlantıları — JavaScript gerektirmez, her kategori kendi sayfasıdır */
export function CategoryNav({ active }: { active: string | null }) {
  const items = [
    { slug: null, name: "Tümü" },
    ...CATEGORIES.map((c) => ({ slug: c.slug, name: c.name })),
  ];
  return (
    <nav aria-label="Kategoriler" className={styles.nav}>
      {items.map((c) => {
        const isActive = c.slug === active;
        return (
          <Link
            key={c.slug ?? "all"}
            href={c.slug ? `/kategori/${c.slug}` : "/"}
            className={`${styles.chip} ${isActive ? styles.active : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            {c.name}
          </Link>
        );
      })}
    </nav>
  );
}
