// Any unmatched path — a stale deep link, or a web host serving the app from a
// non-root URL (the single-file demo) — lands safely on the entry route.
import { Redirect } from "expo-router";

export default function NotFound() {
  return <Redirect href="/" />;
}
