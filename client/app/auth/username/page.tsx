import { Suspense } from "react";
import UsernameSetupClient from "./UsernameSetupClient";

export default function UsernameSetupPage() {
	return (
		<Suspense
			fallback={
				<main className="min-h-screen bg-slate-900 px-6 py-10 text-slate-100 flex items-center justify-center">
					<div className="mx-auto w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-lg shadow-black/20">
						<p className="text-sm text-slate-300">Loading username setup...</p>
					</div>
				</main>
			}
		>
			<UsernameSetupClient />
		</Suspense>
	);
}