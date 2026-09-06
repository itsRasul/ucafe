type BrandLogoProps = {
  className?: string;
  variant?: "mark" | "lockup";
};

export function BrandLogo({ className, variant = "lockup" }: BrandLogoProps) {
  return (
    <img
      className={className}
      src="/brand/ucafe-logo.svg"
      alt=""
      aria-hidden="true"
      width={variant === "mark" ? 512 : 1381}
      height={variant === "mark" ? 512 : 1139}
      decoding="async"
    />
  );
}
