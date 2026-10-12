-- Snapshot de progresso do Bunpou Lab, uma linha por usuário do Netlify Identity.
-- O progresso NÃO é normalizado de propósito: o objeto S do app já é a unidade
-- coerente de estado, e dividi-lo em tabelas tornaria contadores, intervalos e
-- histórico passíveis de ficarem incoerentes entre si.
CREATE TABLE IF NOT EXISTS user_progress (
  user_id       TEXT PRIMARY KEY,
  progress_json JSONB       NOT NULL,
  revision      BIGINT      NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Consulta por data de atualização (diagnóstico/operacional).
CREATE INDEX IF NOT EXISTS user_progress_updated_at_idx
  ON user_progress (updated_at DESC);
