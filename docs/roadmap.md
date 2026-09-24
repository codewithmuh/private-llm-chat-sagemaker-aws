# Roadmap and ideas

Features that fit the architecture, with pointers to where they'd go. Want to build
one? Open an issue saying so, so two people don't build the same thing.

## Next up

- **RAG over your documents.** Today, files are pasted into the prompt, which works up
  to the context window. RAG would chunk documents, embed them with an embedding model
  (a second small SageMaker endpoint, or the router), store vectors in Postgres with
  **pgvector** (RDS supports it), and retrieve only relevant chunks. Where:
  `apps/files` (chunking/embedding on upload), `apps/chat/prompting.py` (retrieval).
- **Amazon Bedrock provider.** Bedrock's Converse API as a third provider, for
  comparing managed models with self-hosted ones. Where: `apps/llm/providers/bedrock.py`.
- **Edit and resend** a user message (branching conversations).
- **Share a conversation** as a read-only link.
- **Usage limits** per user (messages or tokens per day), shown in the admin. Token
  counts are already stored on each message.

## Later

- **Tool calling / agents**: web search, calculator, code execution in a sandbox; vLLM
  supports OpenAI-style tools with `--enable-auto-tool-choice`.
- **Voice**: speech-to-text (Whisper on SageMaker) in the composer, text-to-speech for
  answers.
- **Teams / workspaces** with shared conversations and per-team model access.
- **Prompt library**: saved prompts and custom "assistants" (a system prompt + model).
- **Observability**: token throughput, time-to-first-token and GPU utilisation
  dashboards in CloudWatch.
- **SageMaker inference components**: several models sharing an endpoint's instances,
  with scale-to-zero managed by SageMaker itself.
- **Passkeys (WebAuthn)** as a login and second-factor method.
- **Kubernetes (EKS) variant** for teams that already run EKS.

## Done

See the [changelog](../CHANGELOG.md).
