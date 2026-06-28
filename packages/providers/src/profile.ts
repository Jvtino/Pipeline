// Fetch the connected mailbox's address (for labeling the connection).
import { fetchTransport, type HttpTransport, type ProviderId } from "./oauth";

export async function getEmail(
  provider: ProviderId,
  token: string,
  transport: HttpTransport = fetchTransport,
): Promise<string> {
  if (provider === "google") {
    const j = await transport.getJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", token);
    return (j.emailAddress as string) || "mailbox";
  }
  const j = await transport.getJson("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", token);
  return (j.mail as string) || (j.userPrincipalName as string) || "mailbox";
}
