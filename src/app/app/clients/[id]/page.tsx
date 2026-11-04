import { clientTimeline, listContacts } from "@/server/client-history";
import { ClientCrm } from "./client-crm";
import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n";
import { displayName, getClient, NotFoundError } from "@/server/clients";
import { requirePageContext } from "@/server/request";
import { ClientDetail } from "./client-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("clients.read");
  const { id } = await params;
  const client = await getClient(ctx, id).catch(() => null);
  return { title: client ? displayName(client) : undefined };
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("clients.read");
  const { id } = await params;
  const { locale, region } = await getT();
  const client = await getClient(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const contacts = await listContacts(ctx, client.id);
  const timeline = await clientTimeline(ctx, client.id);
  return (
    <>
    <ClientDetail
      client={{
        id: client.id,
        number: client.number,
        archived: !!client.archivedAt,
        type: client.type,
        status: client.status,
        firstName: client.firstName,
        lastName: client.lastName,
        companyName: client.companyName,
        email: client.email,
        phone: client.phone,
        website: client.website,
        industry: client.industry,
        street: client.street,
        postalCode: client.postalCode,
        city: client.city,
        country: client.country,
        vatId: client.vatId,
        buyerReference: client.buyerReference,
        notes: client.notes,
        tags: client.tags,
        source: client.source,
      }}
      name={displayName(client)}
      created={formatDate(client.createdAt, locale, region)}
      canEdit={ctx.permissions.has("clients.update")}
      canDelete={ctx.permissions.has("clients.delete")}
    />
    <ClientCrm
      clientId={client.id}
      contacts={contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, email: c.email, phone: c.phone }))}
      timeline={timeline}
      me={ctx.user.userId}
      canEdit={ctx.permissions.has("clients.update")}
    />
    </>
  );
}
