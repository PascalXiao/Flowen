import { queries, TEAM_PREFIX, teamAvailableIn, teamsForFilter, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useCallback, useMemo } from "react";

/** 当前登录的人是不是企业管理员。 */
export function useIsOrgAdmin(): boolean {
  const zero = useZero();
  const [admins] = useQuery(queries.org.admins());
  return admins.some((a) => a.userId === zero.userID);
}

/** 所有团队（含成员）。 */
export function useTeams() {
  const [teams] = useQuery(queries.teams.all());
  return teams;
}

/** 某个空间能用的团队，作为人员选项（team:<id>）。 */
export function useTeamChoices(spaceId: string | undefined) {
  const teams = useTeams();
  return useMemo(
    () =>
      teams
        .filter((t) => !spaceId || teamAvailableIn(t, spaceId))
        .map((t) => ({ value: `${TEAM_PREFIX}${t.id}`, label: `团队：${t.name}` })),
    [teams, spaceId],
  );
}

/** 查询前给筛选带上条件里用到的团队的成员名单（team:<id> 由服务端换成这些人）。 */
export function useWithTeams() {
  const teams = useTeams();
  return useCallback(
    <F extends WorkItemFilterArgs | undefined>(filter: F): F => {
      if (!filter) return filter;
      const expanded = teamsForFilter(filter, teams);
      return expanded ? { ...filter, teams: expanded } : filter;
    },
    [teams],
  );
}
