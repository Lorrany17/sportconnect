-- Adicionar coluna regulation_url (e garantir rulebook_url) na tabela tournaments
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS regulation_url TEXT;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS rulebook_url TEXT;

-- Garantir existência e configuração pública do bucket 'tournament-documents'
INSERT INTO storage.buckets (id, name, public)
VALUES ('tournament-documents', 'tournament-documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Políticas de RLS para leitura pública e upload de PDFs no bucket 'tournament-documents'
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Permitir leitura pública de regulamentos e documentos'
    ) THEN
        CREATE POLICY "Permitir leitura pública de regulamentos e documentos"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'tournament-documents');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Permitir upload de regulamentos e documentos'
    ) THEN
        CREATE POLICY "Permitir upload de regulamentos e documentos"
        ON storage.objects FOR INSERT
        WITH CHECK (bucket_id = 'tournament-documents');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Permitir update de regulamentos e documentos'
    ) THEN
        CREATE POLICY "Permitir update de regulamentos e documentos"
        ON storage.objects FOR UPDATE
        USING (bucket_id = 'tournament-documents');
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

