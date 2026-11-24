import Image from "next/image";

export function OneVpnNetworkLogo({ eager = false }: { eager?: boolean }) {
  return (
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcSet="/1vpn-one-network-static.svg" />
      <Image
        src="/1vpn-one-network.svg"
        alt={eager ? "1VPN — единица в глобальной сети" : ""}
        width={720}
        height={720}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        className="network-logo"
        draggable={false}
        unoptimized
      />
    </picture>
  );
}
