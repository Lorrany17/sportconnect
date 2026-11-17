-- ============================================================================
-- Migration: 20261117_sec08_private_receipts_bucket.sql
-- Motivo (SEC-08): Tornar o bucket 'receipts' estritamente privado (public = false).
-- Comprovantes de pagamento contêm dados financeiros sensíveis (PIX, nomes, valores).
-- Apenas o atleta que enviou o comprovante, o organizador do torneio correspondente
-- e o Super Admin podem visualizar o arquivo (via Signed URLs).
-- ============================================================================

-- 1. Garante que o bucket 'receipts' existe e é privado
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  false,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- 2. Limpeza de políticas anteriores no storage.objects para o bucket receipts
DROP POLICY IF EXISTS "Receipts Public Read" ON storage.objects;
DROP POLICY IF EXISTS "Receipts Authenticated Upload" ON storage.objects;
DROP POLICY IF EXISTS "Receipts Owner Read" ON storage.objects;
DROP POLICY IF EXISTS "Receipts Organizer Read" ON storage.objects;
DROP POLICY IF EXISTS "receipts_select_policy" ON storage.objects;
DROP POLICY IF EXISTS "receipts_insert_policy" ON storage.objects;
DROP POLICY IF EXISTS "receipts_update_delete_policy" ON storage.objects;

-- 3. INSERT: Atleta autenticado pode enviar seu comprovante
CREATE POLICY "receipts_insert_policy"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'receipts'
    AND auth.role() = 'authenticated'
  );

-- 4. SELECT: O próprio atleta (owner do objeto), o dono do torneio ou Super Admin
CREATE POLICY "receipts_select_policy"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (
      -- O usuário que fez o upload
      auth.uid() = owner
      -- Ou o usuário é Super Admin
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin = true
      )
      -- Ou o usuário é o organizador do torneio referenciado na equipe vinculada ao recibo
      OR EXISTS (
        SELECT 1 FROM public.teams tm
        JOIN public.tournaments t ON t.id = tm.tournament_id
        WHERE tm.payment_proof_url LIKE '%' || storage.objects.name || '%'
          AND t.owner_id = auth.uid()
      )
    )
  );

-- 5. UPDATE / DELETE: Somente o dono do arquivo ou Super Admin
CREATE POLICY "receipts_update_delete_policy"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (
      auth.uid() = owner
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin = true
      )
    )
  );
