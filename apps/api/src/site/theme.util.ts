export function safeForeground(background: string): "#1F1713" | "#FFFDF8" {
  const hex = background.replace("#", "");
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) throw new Error("Color must be a six-digit hex value");
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  const darkContrast = (luminance + 0.05) / 0.061;
  const lightContrast = 1.047 / (luminance + 0.05);
  return darkContrast >= lightContrast ? "#1F1713" : "#FFFDF8";
}
