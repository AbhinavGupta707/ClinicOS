/** Official Graph template lookup. URLs are built solely from validated numeric
 * provider IDs and registered API versions, never from callback/user URLs. */
export interface MetaTemplateReaderPort {
  read(input: { templateId: string; apiVersion: string; accessToken: string }): Promise<unknown>;
}
export class MetaTemplateReadError extends Error {
  constructor() {
    super("Official template details are unavailable.");
    this.name = "MetaTemplateReadError";
  }
}
export class MetaTemplateReader implements MetaTemplateReaderPort {
  async read(input: {
    templateId: string;
    apiVersion: string;
    accessToken: string;
  }): Promise<unknown> {
    if (
      !/^[1-9][0-9]{1,31}$/u.test(input.templateId) ||
      !/^v[0-9]{1,3}\.[0-9]{1,2}$/u.test(input.apiVersion) ||
      !input.accessToken ||
      /[\r\n]/u.test(input.accessToken)
    )
      throw new MetaTemplateReadError();
    try {
      const response = await fetch(
        `https://graph.facebook.com/${input.apiVersion}/${input.templateId}?fields=id,name,language,status,components,category`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${input.accessToken}` },
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          cache: "no-store"
        }
      );
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new MetaTemplateReadError();
      }
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 262_144) throw new MetaTemplateReadError();
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new MetaTemplateReadError();
    }
  }
}
