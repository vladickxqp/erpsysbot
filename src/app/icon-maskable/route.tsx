import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/app/app-icon";

/** Android crops "maskable" icons into circles and squircles: keep the spark in the safe zone. */
export function GET() {
  return new ImageResponse(<AppIcon padding={12} />, { width: 512, height: 512 });
}
