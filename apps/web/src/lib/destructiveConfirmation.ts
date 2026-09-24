import { ensureLocalApi } from "../localApi";

/** Request the shared themed confirmation and surface failures instead of treating them as cancel. */
export async function requestDestructiveConfirmation(input: {
  readonly message: string;
  readonly onFailure: (error: unknown) => void;
}): Promise<boolean> {
  try {
    return await ensureLocalApi().dialogs.confirm(input.message, { variant: "destructive" });
  } catch (error) {
    input.onFailure(error);
    return false;
  }
}
