-- ============================================================================
-- Migration: 20261117_sec02_protect_profile_admin.sql
-- Motivo (SEC-02): Proteger a coluna profiles.is_admin contra autopromoção indevida.
-- Usuários comuns autenticados só podem atualizar dados cadastrais do próprio perfil
-- (nome, telefone, foto, etc.), mas NUNCA podem alterar is_admin para true.
-- Somente Super Admins existentes ou processos de backend via service_role podem alterar is_admin.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_profile_admin_elevation()
RETURNS TRIGGER AS $$
BEGIN
  -- Se o campo is_admin foi modificado
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    -- Permite se executado em contexto de service_role (backend confiável)
    IF current_setting('role', true) = 'service_role' THEN
      RETURN NEW;
    END IF;

    -- Verifica se o usuário autenticado que está executando a alteração já é Super Admin
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = true
    ) THEN
      RAISE EXCEPTION 'Acesso negado: apenas Super Admins podem alterar permissões administrativas.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Remove a trigger anterior se existir para garantir idempotência
DROP TRIGGER IF EXISTS tr_protect_profile_admin ON public.profiles;

-- Cria a trigger BEFORE UPDATE na tabela profiles
CREATE TRIGGER tr_protect_profile_admin
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.check_profile_admin_elevation();
