-- Lot 1 : création d'une structure par l'opérateur (pnpm operator:create-structure, rôle service_role).
-- Pas de catégories de dépenses ici : la table expense_categories n'existe pas encore ; la migration
-- expenses (Lot 5) crée les sept catégories pour les structures existantes et pour les suivantes.

-- Une invitation créée par l'opérateur n'a pas d'auteur dans profiles. Les utilisateurs, eux, restent
-- tenus d'indiquer le leur : la politique invitations_insert exige created_by = auth.uid().
-- allow-destructive: relâche une contrainte NOT NULL, aucune donnée n'est supprimée
alter table public.invitations alter column created_by drop not null;

-- Sans session utilisateur, l'auteur du journal peut être imposé par app.actor_kind (« system » ou « operator ») ;
-- la session utilisateur reste prioritaire.
create or replace function app.write_audit(
  p_entity_id uuid,
  p_action text,
  p_subject_table text,
  p_subject_id uuid,
  p_details jsonb default '{}'::jsonb,
  p_actor_kind text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  insert into public.audit_logs (entity_id, actor_kind, actor_id, action, subject_table, subject_id, details)
  values (
    p_entity_id,
    case
      when v_uid is not null then 'user'
      else coalesce(nullif(current_setting('app.actor_kind', true), ''), p_actor_kind)
    end,
    v_uid,
    p_action,
    p_subject_table,
    p_subject_id,
    coalesce(p_details, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Crée la structure et invite son premier administrateur (lien privé de 14 jours, jeton renvoyé une seule fois,
-- stocké haché). Une seule transaction. Réservée à service_role.
create function public.create_structure(p_name text, p_kind text, p_admin_email text)
returns table (entity_id uuid, invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_admin_email, '')));
  v_entity uuid;
  v_invitation uuid;
  v_token text;
  v_expires timestamptz;
begin
  if v_name = '' then
    raise exception 'Le nom de la structure est obligatoire';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse e-mail de l''administrateur invalide';
  end if;

  perform set_config('app.actor_kind', 'operator', true);

  insert into public.ownership_entities (name, kind) values (v_name, p_kind) returning id into v_entity;
  perform app.write_audit(v_entity, 'structure.created', 'ownership_entities', v_entity, jsonb_build_object('kind', p_kind));

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (entity_id, kind, email, role, token_hash)
  values (v_entity, 'member', v_email, 'administrator', encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  returning id, public.invitations.expires_at into v_invitation, v_expires;

  return query select v_entity, v_invitation, v_token, v_expires;
end;
$$;

revoke all on function public.create_structure(text, text, text) from public, anon, authenticated;
grant execute on function public.create_structure(text, text, text) to service_role;
