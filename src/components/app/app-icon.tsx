/** The app icon (for next/og ImageResponse, so plain inline styles): a blue rounded square with a white spark. */
export function AppIcon({ padding = 0 }: { padding?: number }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: padding ? "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)" : "transparent" }}>
      <div
        style={{
          width: `${100 - padding * 2}%`,
          height: `${100 - padding * 2}%`,
          borderRadius: padding ? 0 : "22%",
          background: padding ? "transparent" : "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
        </svg>
      </div>
    </div>
  );
}
