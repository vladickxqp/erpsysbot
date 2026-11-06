import { fileResponse } from "../file";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return fileResponse((await params).id, "XRECHNUNG", "attachment");
}
