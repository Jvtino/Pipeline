// CSV export — every signed-in user's derived records (the pricing decision is
// "free for now", so nothing a user's own data depends on sits behind a paywall
// nobody can pay). The builder itself lives in @pipeline/contracts so the API
// route and the phone's demo build emit byte-identical files. (PDF export is a
// thin presentation layer on the same rows; deferred to avoid a heavy PDF
// dependency for now.)
export { toCsv } from "@pipeline/contracts";
