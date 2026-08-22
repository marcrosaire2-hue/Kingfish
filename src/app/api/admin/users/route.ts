import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUserManagementAdmin } from "@/lib/api-auth";
import {
  assertAdminCanManageTarget,
  assertValidRoleSite,
  userVisibleToAdmin,
  type UserRole,
  type UserShift,
  type UserSite,
} from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import {
  createUser,
  createUsersBulk,
  deleteUser,
  getUserById,
  listUsers,
  updateUser,
  type BulkUserInput,
} from "@/lib/users-repo";

export const runtime = "nodejs";

const ROLES: UserRole[] = [
  "gerant",
  "comptable",
  "daf",
  "admin",
];
const SITES: UserSite[] = ["zogbo", "gbegamey", "tous"];

function isRole(v: unknown): v is UserRole {
  return typeof v === "string" && (ROLES as string[]).includes(v);
}

function isSite(v: unknown): v is UserSite {
  return typeof v === "string" && (SITES as string[]).includes(v);
}

export async function GET() {
  try {
    const admin = await requireUserManagementAdmin();
    const users = (await listUsers()).filter((u) =>
      userVisibleToAdmin(admin, u),
    );
    return NextResponse.json({
      users,
      actor: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        site: admin.site,
        isGlobal: admin.site === "tous",
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireUserManagementAdmin();
    const body = (await request.json()) as {
      username?: string;
      name?: string;
      password?: string;
      role?: UserRole;
      site?: UserSite;
      shift?: UserShift;
      users?: BulkUserInput[];
    };

    if (Array.isArray(body.users)) {
      if (body.users.length === 0) {
        return NextResponse.json(
          { error: "Aucun compte à créer." },
          { status: 400 },
        );
      }
      if (body.users.length > 100) {
        return NextResponse.json(
          { error: "Maximum 100 comptes par lot." },
          { status: 400 },
        );
      }

      const cleaned: BulkUserInput[] = [];
      for (const row of body.users) {
        if (
          !row ||
          !row.username ||
          !row.name ||
          !row.password ||
          !isRole(row.role) ||
          !isSite(row.site)
        ) {
          return NextResponse.json(
            {
              error:
                "Chaque ligne doit avoir identifiant, nom, mot de passe, rôle et site.",
            },
            { status: 400 },
          );
        }
        try {
          assertValidRoleSite(row.role, row.site);
          assertAdminCanManageTarget(admin, {
            role: row.role,
            site: row.site,
            username: row.username,
          });
        } catch (e) {
          return NextResponse.json(
            {
              error:
                e instanceof Error
                  ? `${row.username}: ${e.message}`
                  : "Rôle / site invalide",
            },
            { status: 400 },
          );
        }
        cleaned.push({
          username: row.username,
          name: row.name,
          password: row.password,
          role: row.role,
          site: row.site,
        });
      }

      const result = await createUsersBulk(cleaned);
      await logActivity({
        user: admin,
        kind: "user",
        title: `Création groupée · ${result.created.length} compte(s)`,
        detail:
          result.errors.length > 0
            ? `${result.errors.length} erreur(s)`
            : result.created.map((u) => u.username).join(", "),
        site: admin.site === "tous" ? "tous" : admin.site,
      });
      return NextResponse.json(result, { status: 201 });
    }

    if (
      !body.username ||
      !body.name ||
      !body.password ||
      !body.role ||
      !body.site
    ) {
      return NextResponse.json(
        {
          error:
            "Tous les champs sont requis (identifiant, nom, mot de passe, rôle, site).",
        },
        { status: 400 },
      );
    }
    if (!isRole(body.role) || !isSite(body.site)) {
      return NextResponse.json(
        { error: "Rôle ou site invalide." },
        { status: 400 },
      );
    }
    try {
      assertValidRoleSite(body.role, body.site);
      assertAdminCanManageTarget(admin, {
        role: body.role,
        site: body.site,
        username: body.username,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Rôle / site invalide" },
        { status: 400 },
      );
    }

    const user = await createUser({
      username: body.username,
      name: body.name,
      password: body.password,
      role: body.role,
      site: body.site,
      shift: body.shift,
    });
    await logActivity({
      user: admin,
      kind: "user",
      title: `Compte créé · ${user.username}`,
      detail: `${user.name} · ${user.role} · ${user.site}`,
      site: admin.site === "tous" ? "tous" : admin.site,
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    if (error instanceof Error) {
      const msg = error.message;
      if (
        msg.includes("existe") ||
        msg.includes("court") ||
        msg.includes("requis") ||
        msg.includes("rattaché") ||
        msg.includes("zone") ||
        msg.includes("global") ||
        msg.includes("gère")
      ) {
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireUserManagementAdmin();
    const body = (await request.json()) as {
      id?: string;
      name?: string;
      role?: UserRole;
      site?: UserSite;
      shift?: UserShift;
      active?: boolean;
      password?: string;
    };
    if (!body.id) {
      return NextResponse.json({ error: "id requis." }, { status: 400 });
    }
    if (body.role && !isRole(body.role)) {
      return NextResponse.json({ error: "Rôle invalide." }, { status: 400 });
    }
    if (body.site && !isSite(body.site)) {
      return NextResponse.json({ error: "Site invalide." }, { status: 400 });
    }

    const existing = await getUserById(body.id);
    if (!existing) {
      return NextResponse.json(
        { error: "Utilisateur introuvable." },
        { status: 404 },
      );
    }

    try {
      assertAdminCanManageTarget(admin, existing);
      assertAdminCanManageTarget(admin, {
        role: body.role ?? existing.role,
        site: body.site ?? existing.site,
        username: existing.username,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Non autorisé" },
        { status: 403 },
      );
    }

    const user = await updateUser(body.id, {
      name: body.name,
      role: body.role,
      site: body.site,
      shift: body.shift,
      active: body.active,
      password: body.password,
    });
    await logActivity({
      user: admin,
      kind: "user",
      title: `Compte modifié · ${user.username}`,
      detail: `${user.name} · ${user.role} · ${user.site}${user.active ? "" : " · désactivé"}`,
      site: admin.site === "tous" ? "tous" : admin.site,
    });
    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message;
      if (
        msg.includes("introuvable") ||
        msg.includes("Impossible") ||
        msg.includes("court") ||
        msg.includes("requis") ||
        msg.includes("rattaché") ||
        msg.includes("zone") ||
        msg.includes("global") ||
        msg.includes("gère")
      ) {
        return NextResponse.json(
          { error: msg },
          { status: msg.includes("introuvable") ? 404 : 400 },
        );
      }
    }
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireUserManagementAdmin();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id requis." }, { status: 400 });
    }
    const existing = await getUserById(id);
    if (!existing) {
      return NextResponse.json(
        { error: "Utilisateur introuvable." },
        { status: 404 },
      );
    }
    try {
      assertAdminCanManageTarget(admin, existing);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Non autorisé" },
        { status: 403 },
      );
    }
    await deleteUser(id);
    await logActivity({
      user: admin,
      kind: "user",
      title: "Compte supprimé",
      detail: `${existing.username} · id ${id}`,
      site: admin.site === "tous" ? "tous" : admin.site,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message;
      if (msg.includes("Impossible") || msg.includes("introuvable")) {
        return NextResponse.json(
          { error: msg },
          { status: msg.includes("introuvable") ? 404 : 400 },
        );
      }
    }
    return authErrorResponse(error);
  }
}
