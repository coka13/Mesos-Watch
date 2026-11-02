create function public.review_cash_candidate(p_id uuid,p_decision text,p_game_id integer,p_source text,p_note text)returns void language plpgsql security definer set search_path=public as $$
declare c cash_item_candidates;i items;
begin
 if not is_admin()then raise exception 'admins only' using errcode='42501';end if;
 if p_decision not in ('accepted','rejected')or length(btrim(p_note))not between 10 and 1000 then raise exception 'Review decision and note required';end if;
 select * into c from cash_item_candidates where id=p_id and status='pending' for update;
 if not found then raise exception 'Candidate not pending';end if;
 if p_decision='accepted'then
  if p_game_id is null or p_game_id<1 or p_source!~'^https://'or p_source is null then raise exception 'Verified game ID and release source URL required';end if;
  select * into i from items where name_key=norm_name(c.name)or game_id=p_game_id order by id limit 1;
  if found and (i.name_key<>norm_name(c.name)or i.game_id is distinct from p_game_id or i.category<>'cash')then raise exception 'Existing catalog identity conflicts; review manually without overwriting';end if;
  insert into items(game_id,name,category,base_stats,source,source_url,verified,release_status,last_verified_at,verification_source)
   values(p_game_id,c.name,'cash',jsonb_build_object('desc',c.description,'nx_price',c.nx_price,'currency','NX'),'observed',p_source,true,'released',now(),p_source)on conflict(name_key)do nothing;
 end if;
 update cash_item_candidates set status=p_decision,review_note=p_note,reviewed_at=now()where id=p_id;
end $$;
revoke all on function public.review_cash_candidate(uuid,text,integer,text,text)from public,anon;grant execute on function public.review_cash_candidate(uuid,text,integer,text,text)to authenticated;
-- Review can only be performed through the audited RPC, not a raw client patch.
revoke update on cash_item_candidates from authenticated;
revoke update(status,review_note,reviewed_at) on cash_item_candidates from authenticated;
