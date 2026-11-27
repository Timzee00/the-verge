import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type StaffLocation, type StaffMember } from '../api';
import './staff-management.css';

type Props = { organizationId:string; organizationName:string };

const ROLES = [
  { value:'manager', label:'Manager', detail:'Daily operations and permitted approvals' },
  { value:'cashier', label:'Cashier', detail:'POS sales and checkout' },
  { value:'inventory_staff', label:'Inventory staff', detail:'Stock receiving and inventory work' },
  { value:'accountant', label:'Accountant', detail:'Financial records and reporting' },
  { value:'staff', label:'Staff', detail:'Basic business access' },
] as const;

export default function StaffManagement({organizationId,organizationName}:Props) {
  const [staff,setStaff] = useState<StaffMember[]>([]);
  const [locations,setLocations] = useState<StaffLocation[]>([]);
  const [assignmentDrafts,setAssignmentDrafts] = useState<Record<string,string[]>>({});
  const [selectedLocationIds,setSelectedLocationIds] = useState<string[]>([]);
  const [email,setEmail] = useState('');
  const [role,setRole] = useState('cashier');
  const [query,setQuery] = useState('');
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [updatingId,setUpdatingId] = useState('');
  const [notice,setNotice] = useState('');
  const [error,setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const result=await api.staffList(organizationId);
      setStaff(result.staff);
      setLocations(result.locations);
      setAssignmentDrafts(Object.fromEntries(result.staff.map(member=>[member.userId,member.locationIds??[]])));
      setSelectedLocationIds(previous=>{
        const stillAvailable=previous.filter(id=>result.locations.some(location=>location.id===id));
        return stillAvailable.length?stillAvailable:(result.locations[0]?[result.locations[0].id]:[]);
      });
    } catch(err) { setError(err instanceof Error?err.message:'Could not load staff.'); }
    finally { setLoading(false); }
  }
  useEffect(()=>{void load();},[organizationId]);

  const filtered = useMemo(()=>{
    const q=query.trim().toLocaleLowerCase();
    return staff.filter(member=>!q||[member.displayName,member.email,member.role,...(member.locationNames??[])].some(value=>String(value??'').toLocaleLowerCase().includes(q)));
  },[staff,query]);

  const activeCount = staff.filter(member=>member.active).length;

  async function addMember(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized=email.trim().toLocaleLowerCase();
    if(!normalized||saving)return;
    if(!selectedLocationIds.length){setError('Assign at least one location before adding this employee.');return;}
    setSaving(true); setError(''); setNotice('');
    try {
      await api.addStaff({organizationId,email:normalized,role,locationIds:selectedLocationIds});
      setEmail('');
      setNotice('Staff access and location assignments have been saved. The employee can now sign in and choose this business.');
      await load();
    } catch(err) {
      const message=err instanceof Error?err.message:'Could not add staff member.';
      setError(message==='account_not_found'?'No active Verge account uses that email. Ask the employee to create an account first.':message==='at_least_one_location_required'?'Choose at least one location.':message);
    } finally { setSaving(false); }
  }

  async function changeMember(member:StaffMember,action:'deactivate'|'reactivate'|'change_role'|'assign_locations',nextRole?:string) {
    if(updatingId)return;
    const locationIds=assignmentDrafts[member.userId]??member.locationIds??[];
    if(action==='assign_locations'&&!locationIds.length){setError('A staff member must be assigned to at least one active location.');return;}
    setUpdatingId(member.userId); setError(''); setNotice('');
    try {
      await api.updateStaff({organizationId,userId:member.userId,action,role:nextRole,locationIds:action==='assign_locations'?locationIds:undefined});
      setNotice(action==='deactivate'?'Staff access has been disabled.':action==='reactivate'?'Staff access has been restored.':action==='change_role'?'Staff role updated.':'Location access updated.');
      await load();
    } catch(err) { setError(err instanceof Error?err.message:'Could not update staff access.'); }
    finally { setUpdatingId(''); }
  }

  function toggleLocation(values:string[],id:string) {
    return values.includes(id)?values.filter(value=>value!==id):[...values,id];
  }

  return <div className="staff-admin-page">
    <header className="staff-admin-heading">
      <div><span className="staff-admin-kicker">BUSINESS ACCESS</span><h1>Team and permissions</h1><p>Manage who can access {organizationName}, their role and the locations they can work in.</p></div>
      <div className="staff-admin-count"><strong>{activeCount}</strong><span>active team members</span></div>
    </header>

    {notice&&<div className="staff-admin-notice" role="status">{notice}<button type="button" onClick={()=>setNotice('')} aria-label="Dismiss">×</button></div>}
    {error&&<div className="staff-admin-error" role="alert">{error}<button type="button" onClick={()=>setError('')} aria-label="Dismiss">×</button></div>}

    <div className="staff-admin-grid">
      <section className="staff-admin-panel staff-admin-add">
        <div className="staff-admin-section-title"><div><span className="staff-admin-kicker">ADD A TEAM MEMBER</span><h2>Give staff access</h2></div><span className="staff-admin-icon">+</span></div>
        <p>Enter the email address linked to the employee's existing Verge account. Their own account and other business workspaces remain separate.</p>
        <form onSubmit={addMember}>
          <label>Email address<input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="employee@example.com"/></label>
          <label>Access role<select value={role} onChange={event=>setRole(event.target.value)}>{ROLES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <p className="staff-admin-role-help">{ROLES.find(item=>item.value===role)?.detail}</p>
          <div className="staff-admin-location-picker">
            <strong>Assigned locations <span>Required</span></strong>
            {locations.length?locations.map(location=><label key={location.id}><input type="checkbox" checked={selectedLocationIds.includes(location.id)} onChange={()=>setSelectedLocationIds(previous=>toggleLocation(previous,location.id))}/><span>{location.name}</span></label>):<small>Add an active branch or warehouse before assigning staff.</small>}
          </div>
          <button className="staff-admin-primary" type="submit" disabled={saving||!email.trim()||!locations.length||!selectedLocationIds.length}>{saving?'Saving access…':'Add to team'}</button>
        </form>
        <div className="staff-admin-security-note"><strong>Access control</strong><span>Staff are restricted to the locations selected here. Server-side checks enforce these assignments for sales and inventory records.</span></div>
      </section>

      <section className="staff-admin-panel staff-admin-directory">
        <div className="staff-admin-directory-head"><div><span className="staff-admin-kicker">TEAM DIRECTORY</span><h2>People with access</h2></div><button type="button" className="staff-admin-refresh" onClick={()=>void load()} disabled={loading}>↻ Refresh</button></div>
        <label className="staff-admin-search"><span>⌕</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search by name, email, role or location…"/></label>
        {loading?<div className="staff-admin-empty">Loading team members…</div>:filtered.length===0?<div className="staff-admin-empty">{query?'No team members match this search.':'No staff accounts have been added yet.'}</div>:
          <div className="staff-admin-table-wrap"><table className="staff-admin-table"><thead><tr><th>Team member</th><th>Role</th><th>Locations</th><th>Status</th><th>Manage</th></tr></thead><tbody>{filtered.map(member=>{
            const memberLocationIds=assignmentDrafts[member.userId]??member.locationIds??[];
            return <tr key={member.userId}>
              <td><div className="staff-admin-person"><span className="staff-admin-avatar">{String(member.displayName||member.email).slice(0,1).toUpperCase()}</span><span><strong>{member.displayName||'Verge member'}</strong><small>{member.email}</small></span></div></td>
              <td><select className="staff-admin-role-select" aria-label={`Role for ${member.email}`} value={member.role} disabled={!member.active||updatingId===member.userId} onChange={event=>void changeMember(member,'change_role',event.target.value)}>{ROLES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></td>
              <td><details className="staff-admin-location-details"><summary>{memberLocationIds.length?memberLocationIds.map(id=>locations.find(location=>location.id===id)?.name).filter(Boolean).join(', '):'No locations assigned'}</summary><div className="staff-admin-assignment-menu">{locations.map(location=><label key={location.id}><input type="checkbox" checked={memberLocationIds.includes(location.id)} disabled={updatingId===member.userId} onChange={()=>setAssignmentDrafts(previous=>({...previous,[member.userId]:toggleLocation(memberLocationIds,location.id)}))}/><span>{location.name}</span></label>)}<button type="button" disabled={updatingId===member.userId||!memberLocationIds.length} onClick={()=>void changeMember(member,'assign_locations')}>Save locations</button></div></details></td>
              <td><span className={member.active?'staff-admin-status active':'staff-admin-status inactive'}>{member.active?'Active':'Disabled'}</span></td>
              <td><button type="button" className={member.active?'staff-admin-disable':'staff-admin-enable'} disabled={updatingId===member.userId} onClick={()=>void changeMember(member,member.active?'deactivate':'reactivate')}>{updatingId===member.userId?'Saving…':member.active?'Disable':'Restore'}</button></td>
            </tr>;
          })}</tbody></table></div>}
        <div className="staff-admin-footnote">Role and location changes are recorded in the audit log. Disabled memberships lose access on their next server request.</div>
      </section>
    </div>
  </div>;
}
