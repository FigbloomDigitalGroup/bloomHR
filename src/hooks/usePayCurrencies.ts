import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadPayCurrencies } from '../lib/payroll/usdPayApi';
import type { PayCurrencies } from '../lib/payroll/usdPay';

const KEY = ['pay-currencies'] as const;
const NONE: PayCurrencies = new Map();

/** The currency each country is paid in (FIG-906): local unless the company chose USD. Shared by every screen. */
export function usePayCurrencies() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: loadPayCurrencies });
  const reload = useCallback(() => client.invalidateQueries({ queryKey: KEY }), [client]);
  return { payCurrencies: query.data ?? NONE, loading: query.isLoading, reload };
}
