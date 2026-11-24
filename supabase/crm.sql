-- CRM com IA: tudo do CRM fica nesta tabela, uma linha por "gaveta"
-- (configuração, clientes, aprovações, agenda, catálogo, cada conversa...).
-- Só o usuário logado lê e grava as próprias linhas (RLS). Quem só tem a
-- chave publishable/anon, sem login, não vê nada.
-- Rode uma vez no Supabase: SQL Editor > cole tudo > Run.

create table if not exists public.crm_dados (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chave text not null,
  valor jsonb,            -- vazio (null) = gaveta apagada, para os outros aparelhos saberem
  dispositivo text,       -- qual navegador gravou por último
  atualizado_em timestamptz not null default now(),
  primary key (user_id, chave)
);

create index if not exists crm_dados_atualizado_em on public.crm_dados (user_id, atualizado_em);

alter table public.crm_dados enable row level security;

revoke all on public.crm_dados from anon;
grant select, insert, update, delete on public.crm_dados to authenticated;

drop policy if exists "crm: dono le" on public.crm_dados;
drop policy if exists "crm: dono cria" on public.crm_dados;
drop policy if exists "crm: dono altera" on public.crm_dados;
drop policy if exists "crm: dono apaga" on public.crm_dados;

create policy "crm: dono le" on public.crm_dados
  for select to authenticated using (user_id = (select auth.uid()));
create policy "crm: dono cria" on public.crm_dados
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "crm: dono altera" on public.crm_dados
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "crm: dono apaga" on public.crm_dados
  for delete to authenticated using (user_id = (select auth.uid()));

-- O horário de cada gravação vem do servidor, para os aparelhos saberem o que mudou.
create or replace function public.crm_dados_carimbo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists crm_dados_carimbo on public.crm_dados;
create trigger crm_dados_carimbo
  before insert or update on public.crm_dados
  for each row execute function public.crm_dados_carimbo();
