/** 全域 toast：任何地方呼叫 toast()/toastError()，由 App 掛載的 <Toaster /> 顯示 */
export type ToastKind = "success" | "error";

export interface ToastMsg {
  id: number;
  text: string;
  kind: ToastKind;
}

type Listener = (msg: ToastMsg) => void;

let listener: Listener | null = null;
let nextId = 0;

export function toast(text: string, kind: ToastKind = "success") {
  listener?.({ id: ++nextId, text, kind });
}

export function toastError(text: string) {
  toast(text, "error");
}

/** 由 <Toaster /> 訂閱；回傳取消訂閱函式 */
export function subscribeToast(l: Listener): () => void {
  listener = l;
  return () => {
    if (listener === l) listener = null;
  };
}
