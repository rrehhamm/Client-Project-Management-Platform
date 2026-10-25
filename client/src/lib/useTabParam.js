import { useSearchParams } from 'react-router';

/** Current tab kept in ?tab= so it survives refresh and can be linked. */
export function useTabParam(allowed, fallback) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');
  const value = allowed.includes(tab) ? tab : fallback;
  const setTab = (next) =>
    setParams(
      (p) => {
        const copy = new URLSearchParams(p);
        if (next === fallback) copy.delete('tab');
        else copy.set('tab', next);
        return copy;
      },
      { replace: true },
    );
  return [value, setTab];
}
