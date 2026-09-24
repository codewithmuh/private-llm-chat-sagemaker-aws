/** Links and names used by the public pages (landing page, docs). */

export const SITE_NAME = "Private LLM Chat";

export const GITHUB_URL = "https://github.com/codewithmuh/private-llm-chat-sagemaker-aws";

/** A file in the repository on GitHub, e.g. repoFileUrl("ml/models/catalog.json"). */
export function repoFileUrl(path: string, mode: "blob" | "edit" = "blob"): string {
  return `${GITHUB_URL}/${mode}/main/${path.replace(/^\/+/, "")}`;
}

export const CLONE_COMMAND = `git clone ${GITHUB_URL}.git
cd private-llm-chat-sagemaker-aws
make up`;
