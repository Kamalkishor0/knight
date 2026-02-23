"use client";

type NavBarProps = {
    onLogout: () => void | Promise<void>;
};

export function NavBar({ onLogout }: NavBarProps) {
    return (
        <nav className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Knight</h1>
            <button
                onClick={onLogout}
                className="cursor-pointer text-sm text-slate-200 transition hover:underline hover:decoration-1 hover:underline-offset-4"
            >
                Logout
            </button>
        </nav>
    )
}