import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export function useLibrary() {
  return useQuery({ queryKey: ["library"], queryFn: api.library });
}
