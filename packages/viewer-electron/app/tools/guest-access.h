#pragma once
#import <Foundation/Foundation.h>
#include <sys/stat.h>
#include <sys/acl.h>
#include <membership.h>
#include <pwd.h>
#include <grp.h>
#include <array>
#include <vector>

using GuestMembershipProbe = int (*)(uid_t, gid_t, int *);
static int guestMembership(uid_t user, gid_t group, int *member) {
  uuid_t userID, groupID;
  int status = mbr_uid_to_uuid(user, userID);
  if (!status) status = mbr_gid_to_uuid(group, groupID);
  return status ? status : mbr_check_membership(userID, groupID, member);
}
struct GuestPrincipal {
  uid_t user;
  gid_t primary;
  std::vector<int> groups;
  bool knownGroups;
  GuestMembershipProbe probe;
  // Each right is undecided, denied, granted or uncertain. An earlier decision wins.
  std::array<int, 8> decisions{};
  int member(gid_t group) const {
    if (group == 12 || group == primary) return 1;
    for (int value : groups) if ((gid_t)value == group) return 1;
    int membership = 0;
    // A flat group list cannot disprove membership through a nested directory group.
    return probe(user, group, &membership) == 0 && (membership == 0 || membership == 1) ? membership : -1;
  }
};
static GuestPrincipal guestPrincipal(const char *name, uid_t user, gid_t primary, GuestMembershipProbe probe) {
  struct passwd record{}, *found = nullptr; char buffer[16384];
  int status = user == 201
    ? getpwuid_r(user, &record, buffer, sizeof(buffer), &found)
    : getpwnam_r(name, &record, buffer, sizeof(buffer), &found);
  GuestPrincipal result{found ? record.pw_uid : user, found ? record.pw_gid : primary, {}, status == 0, probe};
  if (!found) return result;
  int count = 32; result.groups.resize(count);
  if (getgrouplist(record.pw_name, (int)record.pw_gid, result.groups.data(), &count) < 0) {
    if (count > 0 && count <= 1024) {
      result.groups.resize(count);
      result.knownGroups = getgrouplist(record.pw_name, (int)record.pw_gid, result.groups.data(), &count) == 0;
    } else result.knownGroups = false;
  }
  if (result.knownGroups) result.groups.resize(count); else result.groups.clear();
  return result;
}
static NSString *guestACLState(NSString *file, const struct stat *provided = nullptr, GuestMembershipProbe probe = guestMembership) {
  struct stat info{};
  if (provided) info = *provided;
  else if (stat(file.fileSystemRepresentation, &info) != 0) return @"unreadable";
  // Both SMB guest identities count, including the reserved Guest identity when its account is off.
  std::array<GuestPrincipal, 2> guests = {
    guestPrincipal("nobody", (uid_t)-2, (gid_t)-2, probe), guestPrincipal("Guest", 201, 201, probe)
  };
  // A guest owner can change mode bits even when no current write bit is set.
  for (const auto &guest : guests) if (info.st_uid == guest.user) return @"write";
  bool unknown = false;
  acl_t acl = acl_get_file(file.fileSystemRepresentation, ACL_TYPE_EXTENDED);
  if (!acl) {
    if (errno != ENOENT) return @"unreadable";
  }
  if (acl && acl_valid(acl) != 0) { acl_free(acl); return @"unknown"; }
  acl_entry_t entry;
  int state = acl ? acl_get_entry(acl, ACL_FIRST_ENTRY, &entry) : -1;
  while (state == 0) {
    acl_tag_t tag;
    acl_permset_t permissions;
    acl_flagset_t flags;
    if (acl_get_tag_type(entry, &tag) != 0 || acl_get_permset(entry, &permissions) != 0 || acl_get_flagset_np(entry, &flags) != 0) { unknown = true; break; }
    int inheritOnly = acl_get_flag_np(flags, ACL_ENTRY_ONLY_INHERIT);
    if (inheritOnly < 0) { unknown = true; break; }
    if (!inheritOnly && (tag == ACL_EXTENDED_ALLOW || tag == ACL_EXTENDED_DENY)) {
      const acl_perm_t modifying[] = { ACL_ADD_FILE, ACL_ADD_SUBDIRECTORY, ACL_DELETE_CHILD, ACL_DELETE,
        ACL_WRITE_ATTRIBUTES, ACL_WRITE_EXTATTRIBUTES, ACL_WRITE_SECURITY, ACL_CHANGE_OWNER };
      void *qualifier = acl_get_qualifier(entry);
      id_t identifier = 0; int type = 0;
      bool known = qualifier && mbr_uuid_to_id((const unsigned char *)qualifier, &identifier, &type) == 0;
      if (qualifier) acl_free(qualifier);
      for (auto &guest : guests) {
        int applies = -1;
        if (known) {
          if (type == ID_TYPE_UID) applies = (uid_t)identifier == guest.user ? 1 : 0;
          else if (type == ID_TYPE_GID) applies = guest.member((gid_t)identifier);
        }
        if (!applies) continue;
        for (size_t index = 0; index < 8; ++index) {
          int allowed = acl_get_perm_np(permissions, modifying[index]);
          if (allowed < 0) { unknown = true; continue; }
          if (!allowed || guest.decisions[index]) continue;
          guest.decisions[index] = applies < 0 ? 3 : tag == ACL_EXTENDED_ALLOW ? 2 : 1;
        }
      }
    } else if (!inheritOnly) unknown = true;
    state = acl_get_entry(acl, ACL_NEXT_ENTRY, &entry);
  }
  if (acl) acl_free(acl);
  for (auto &guest : guests) {
    bool writable = (info.st_mode & S_IWOTH) || (info.st_uid == guest.user && (info.st_mode & S_IWUSR));
    if (info.st_mode & S_IWGRP) {
      int group = guest.member(info.st_gid);
      if (group > 0) writable = true;
      else if (group < 0) unknown = true;
    }
    for (size_t index = 0; index < guest.decisions.size(); ++index) {
      int decision = guest.decisions[index];
      if (decision == 2) return @"write";
      if (decision == 3) unknown = true;
      if (!decision && !unknown && index < 3 && writable) return @"write";
    }
  }
  return unknown ? @"unknown" : @"none";
}
