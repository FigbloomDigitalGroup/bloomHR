-- Salary advances: no limit on the amount; the approvers decide.
--
-- 20261027800000 limited a request to 30% of the person's basic salary, checked on insert. That limit is taken away:
-- the trigger and its function are dropped, so staff asking for themselves and an admin applying on someone's behalf
-- can ask for any amount above nothing. The request still goes through the company's approval chain as before.
-- Written to run again safely.

drop trigger if exists salary_advance_within_limit on public.salary_advance;
drop function if exists public.salary_advance_within_limit();

notify pgrst, 'reload schema';
