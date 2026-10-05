import styles from "./Logo.module.css";

/** Onaylanan logo (C): kare "g" işareti + "gündemci" yazısı */
export function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className={`${styles.logo} ${size === "sm" ? styles.sm : ""}`}>
      <span className={styles.mark} aria-hidden="true">
        g
      </span>
      <span className={styles.word}>gündemci</span>
    </span>
  );
}
