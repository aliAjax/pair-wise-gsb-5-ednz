import {useEffect, useState} from 'react';
import {store} from '../data/store';
import type {AppState} from '../domain/types';

/** 订阅数据层；界面不直接修改状态，只调用 store 动作 */
export const useStore = (): AppState => {
  const [state, setState] = useState<AppState>(store.getState());
  useEffect(() => {
    const update = () => setState(store.getState());
    update();
    return store.subscribe(update);
  }, []);
  return state;
};
