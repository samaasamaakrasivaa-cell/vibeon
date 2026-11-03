import { EXTRA_ICONS, ICONS, type IconName } from "./icon-paths";

const ALL: Record<string, string> = { ...ICONS, ...EXTRA_ICONS };

export function Icon({ name, size, className = "" }: { name: IconName; size?: "sm" | "lg"; className?: string }) {
  return (
    <svg
      className={`i ${size ?? ""} ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ALL[name] }}
    />
  );
}
