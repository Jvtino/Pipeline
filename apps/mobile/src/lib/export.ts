// "Export your data" — fetch the server's CSV, write it to a private cache
// file, hand it to the OS share sheet. Deliberately NOT a download-to-Files
// flow: the share sheet is the phone-native way to get data somewhere useful
// (mail it, drop it in Drive, open it in Numbers) and it's one tap.
//
// The file lands in the app's own cache directory, which iOS/Android clear on
// their own schedule and no other app can read — the CSV never becomes a
// permanent artifact the user has to clean up.
import { Platform, Share } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { exportFilename } from "./format";
import { requestText } from "../api/client";
import { DEMO } from "../auth/mode";
import { demoCsv } from "../demo/store";

/**
 * Fetch → write → share. Returns quietly once the sheet is dismissed; throws
 * only when the data couldn't be fetched or written (the caller shows that).
 */
export async function shareApplicationsCsv(): Promise<void> {
  const csv = DEMO ? demoCsv() : await requestText("/api/export.csv");

  // Web (and the demo build) has no file system or native share sheet — fall
  // back to the platform's own share, which takes plain text.
  if (Platform.OS === "web" || !(await Sharing.isAvailableAsync().catch(() => false))) {
    await Share.share({ message: csv, title: exportFilename() });
    return;
  }

  const file = new File(Paths.cache, exportFilename());
  if (file.exists) file.delete(); // a same-day re-export replaces its predecessor
  file.create();
  file.write(csv);
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/csv",
    UTI: "public.comma-separated-values-text",
    dialogTitle: "Export your applications",
  });
}
