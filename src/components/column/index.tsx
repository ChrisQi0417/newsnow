import type { FixedColumnID } from "@shared/types"
import { Desk } from "~/components/desk"

export function Column({ id }: { id: FixedColumnID }) {
  return <Desk id={id} />
}
