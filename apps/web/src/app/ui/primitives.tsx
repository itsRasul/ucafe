import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

type ButtonStyle = { variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive"; size?: "sm" | "md" | "lg" };
function buttonClass({ variant = "primary", size = "md", className = "" }: ButtonStyle & { className?: string }) { return `uc-button uc-button--${variant} uc-button--${size} ${className}`; }
export function Button({ variant, size, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyle) { return <button className={buttonClass({ variant, size, className })} {...props} />; }
export function ButtonLink({ variant, size, className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & ButtonStyle) { return <a className={buttonClass({ variant, size, className })} {...props} />; }
export function SectionHeader({ id, title, description }: { id: string; title: string; description?: string }) { return <div className="uc-section-heading"><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>; }
