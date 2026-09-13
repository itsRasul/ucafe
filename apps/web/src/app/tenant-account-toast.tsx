"use client";

import "react-toastify/dist/ReactToastify.css";
import { Slide, ToastContainer, toast } from "react-toastify";

const accountToastId = "tenant-client-account";

export function TenantAccountToast() {
  return <ToastContainer containerId={accountToastId} className="tenant-toast-container" toastClassName="tenant-toast" position="bottom-right" autoClose={4200} hideProgressBar newestOnTop closeOnClick={false} pauseOnHover rtl limit={3} transition={Slide} aria-label="اعلان حساب کاربری" />;
}

export function showClientSignedOutToast() {
  toast.success("شما با موفقیت خارج شدید.", { containerId: accountToastId, toastId: "client-signed-out", icon: false, ariaLabel: "شما با موفقیت خارج شدید" });
}
