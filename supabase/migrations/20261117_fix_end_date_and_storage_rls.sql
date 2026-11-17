-- ============================================================================
-- 1. Adicionar coluna end_date na tabela tournaments (suporte a múltiplos dias)
-- ============================================================================
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ;

-- Atualiza o cache de schema do PostgREST para reconhecer end_date imediatamente
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 2. Garantir bucket 'tournament-documents' público e configurar RLS de Storage
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('tournament-documents', 'tournament-documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Remove políticas antigas conflituosas (se existirem)
DROP POLICY IF EXISTS "Allow public read on tournament-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated upload on tournament-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated update on tournament-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete on tournament-documents" ON storage.objects;

-- Leitura pública dos PDFs de regulamento
CREATE POLICY "Allow public read on tournament-documents"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'tournament-documents');

-- Upload (INSERT) permitido apenas para utilizadores autenticados
CREATE POLICY "Allow authenticated upload on tournament-documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'tournament-documents');

-- Atualização (UPDATE) permitida para o dono do ficheiro autenticado
CREATE POLICY "Allow authenticated update on tournament-documents"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'tournament-documents' AND auth.uid() = owner);

-- Remoção (DELETE) permitida para o dono do ficheiro autenticado
CREATE POLICY "Allow authenticated delete on tournament-documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'tournament-documents' AND auth.uid() = owner);
