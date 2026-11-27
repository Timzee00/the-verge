import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { BusinessLocation, BusinessProfile } from '../api';
import { api } from '../api';

type Props = {
  organizationId: string;
  organizationName: string;
  onBusinessChanged: (business: BusinessProfile) => void;
  onRefresh: () => Promise<void>;
};
type LocationDraft = {
  name: string; type: 'region'|'branch'|'warehouse'; code: string; parentId: string;
  phone: string; contactEmail: string; addressLine1: string; addressLine2: string;
  city: string; state: string; postalCode: string;
};
const EMPTY_LOCATION: LocationDraft = {
  name:'', type:'branch', code:'', parentId:'', phone:'', contactEmail:'',
  addressLine1:'', addressLine2:'', city:'', state:'', postalCode:'',
};
const INDUSTRIES = ['Retail / General','Supermarket','Pharmacy','Hospital / Clinic','Printing Shop','Restaurant / Food','Fashion','Student Business','Real Estate','Services','Other'];
function makeDraft(location?:BusinessLocation):LocationDraft {
  return location ? {
    name:location.name,type:location.type,code:location.code??'',parentId:location.parentId??'',
    phone:location.phone??'',contactEmail:location.contactEmail??'',
    addressLine1:location.addressLine1??'',addressLine2:location.addressLine2??'',
    city:location.city??'',state:location.state??'',postalCode:location.postalCode??'',
  } : {...EMPTY_LOCATION};
}

export default function BusinessWorkspace({organizationId,organizationName,onBusinessChanged,onRefresh}:Props) {
  const [business,setBusiness]=useState<BusinessProfile|null>(null);
  const [locations,setLocations]=useState<BusinessLocation[]>([]);
  const [canManage,setCanManage]=useState(false);
  const [loading,setLoading]=useState(true);
  const [savingProfile,setSavingProfile]=useState(false);
  const [savingLocation,setSavingLocation]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [profileDraft,setProfileDraft]=useState<Partial<BusinessProfile>>({});
  const [editingLocationId,setEditingLocationId]=useState('');
  const [draft,setDraft]=useState<LocationDraft>({...EMPTY_LOCATION});
  const [showLocationForm,setShowLocationForm]=useState(false);

  async function load() {
    setLoading(true);setError('');
    try {
      const [profileResult,locationResult]=await Promise.all([api.business(organizationId),api.locations(organizationId)]);
      setBusiness(profileResult.business);setProfileDraft(profileResult.business);
      setCanManage(profileResult.canManage&&locationResult.canManage);
      setLocations(locationResult.locations);
    } catch(err) { setError(err instanceof Error?err.message:'Business information could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(()=>{void load();},[organizationId]);

  const activeLocations=useMemo(()=>locations.filter(item=>item.active),[locations]);
  const archivedLocations=useMemo(()=>locations.filter(item=>!item.active),[locations]);
  const regions=activeLocations.filter(item=>item.type==='region');

  function updateProfile(key:keyof BusinessProfile,value:string) {
    setProfileDraft(previous=>({...previous,[key]:value}));
  }

  async function saveProfile(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!canManage||savingProfile)return;
    setSavingProfile(true);setError('');setNotice('');
    try {
      const result=await api.updateBusiness({
        organizationId,name:String(profileDraft.name??'').trim(),industry:String(profileDraft.industry??''),
        legalName:String(profileDraft.legalName??''),contactEmail:String(profileDraft.contactEmail??''),
        phone:String(profileDraft.phone??''),addressLine1:String(profileDraft.addressLine1??''),
        addressLine2:String(profileDraft.addressLine2??''),city:String(profileDraft.city??''),
        state:String(profileDraft.state??''),postalCode:String(profileDraft.postalCode??''),
        website:String(profileDraft.website??''),taxIdentifier:String(profileDraft.taxIdentifier??''),
      });
      setBusiness(result.business);setProfileDraft(result.business);onBusinessChanged(result.business);
      setNotice('Business profile saved.');
    } catch(err) { setError(err instanceof Error?err.message:'Business profile could not be saved.'); }
    finally { setSavingProfile(false); }
  }

  function beginCreateLocation() {
    setEditingLocationId('');setDraft({...EMPTY_LOCATION});setShowLocationForm(true);
  }
  function beginEditLocation(location:BusinessLocation) {
    setEditingLocationId(location.id);setDraft(makeDraft(location));setShowLocationForm(true);
  }

  async function saveLocation(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!canManage||savingLocation)return;
    setSavingLocation(true);setError('');setNotice('');
    try {
      const payload={
        organizationId,name:draft.name.trim(),type:draft.type,code:draft.code.trim()||undefined,
        parentId:draft.parentId||undefined,phone:draft.phone,contactEmail:draft.contactEmail,
        addressLine1:draft.addressLine1,addressLine2:draft.addressLine2,city:draft.city,
        state:draft.state,postalCode:draft.postalCode,
      };
      if(editingLocationId) {
        await api.updateLocation({...payload,code:draft.code.trim()||null,parentId:draft.parentId||null,locationId:editingLocationId,action:'update'});
        setNotice('Location details updated.');
      } else {
        await api.createLocation(payload);
        setNotice('New location created.');
      }
      setShowLocationForm(false);setEditingLocationId('');setDraft({...EMPTY_LOCATION});
      await load();await onRefresh();
    } catch(err) { setError(err instanceof Error?err.message:'Location could not be saved.'); }
    finally { setSavingLocation(false); }
  }

  async function changeLocationAvailability(location:BusinessLocation,action:'archive'|'restore') {
    if(!canManage||savingLocation)return;
    const prompt=action==='archive'
      ? 'Archive '+location.name+'? It will stop appearing as an active work location. Existing sales and inventory records will remain.'
      : 'Restore '+location.name+' as an active work location?';
    if(!window.confirm(prompt))return;
    setSavingLocation(true);setError('');setNotice('');
    try {
      await api.updateLocation({organizationId,locationId:location.id,action});
      setNotice(action==='archive'?'Location archived. Historical records were preserved.':'Location restored.');
      await load();await onRefresh();
    } catch(err) { setError(err instanceof Error?err.message:'Location availability could not be changed.'); }
    finally { setSavingLocation(false); }
  }

  if(loading)return <section className="panel business-loading" aria-live="polite">Loading business profile and locations…</section>;

  return <div className="business-workspace">
    <header className="page-head">
      <div><span className="eyebrow">BUSINESS MANAGEMENT</span><h1>{business?.name??organizationName}</h1><p>Keep your legal, contact and branch information accurate for daily operations and future documents.</p></div>
      <div className="business-header-meta"><span className="business-currency">{business?.baseCurrency??'NGN'}</span><span>{activeLocations.length} active locations</span></div>
    </header>
    {notice&&<div className="business-feedback success" role="status">{notice}<button type="button" onClick={()=>setNotice('')} aria-label="Dismiss message">×</button></div>}
    {error&&<div className="business-feedback error" role="alert">{error}<button type="button" onClick={()=>setError('')} aria-label="Dismiss error">×</button></div>}

    <section className="panel business-profile-panel">
      <div className="section-head"><div><span className="eyebrow">BUSINESS IDENTITY</span><h2>Business profile</h2><p>This information is stored against the business, not an individual staff account.</p></div></div>
      <form onSubmit={saveProfile}>
        <div className="business-form-grid">
          <label>Trading / business name<input required maxLength={120} disabled={!canManage} value={String(profileDraft.name??'')} onChange={event=>updateProfile('name',event.target.value)}/></label>
          <label>Industry<select disabled={!canManage} value={String(profileDraft.industry??'Retail / General')} onChange={event=>updateProfile('industry',event.target.value)}>{INDUSTRIES.map(item=><option key={item}>{item}</option>)}</select></label>
          <label>Registered / legal name<input maxLength={160} disabled={!canManage} value={String(profileDraft.legalName??'')} onChange={event=>updateProfile('legalName',event.target.value)} placeholder="As shown on registration documents"/></label>
          <label>Tax / registration identifier<input maxLength={60} disabled={!canManage} value={String(profileDraft.taxIdentifier??'')} onChange={event=>updateProfile('taxIdentifier',event.target.value)} placeholder="Optional"/></label>
          <label>Business email<input type="email" maxLength={320} disabled={!canManage} value={String(profileDraft.contactEmail??'')} onChange={event=>updateProfile('contactEmail',event.target.value)} placeholder="business@example.com"/></label>
          <label>Phone number<input type="tel" maxLength={40} disabled={!canManage} value={String(profileDraft.phone??'')} onChange={event=>updateProfile('phone',event.target.value)} placeholder="+234…"/></label>
          <label>Website<input type="url" maxLength={240} disabled={!canManage} value={String(profileDraft.website??'')} onChange={event=>updateProfile('website',event.target.value)} placeholder="https://example.com"/></label>
          <label>Address line 1<input maxLength={160} disabled={!canManage} value={String(profileDraft.addressLine1??'')} onChange={event=>updateProfile('addressLine1',event.target.value)}/></label>
          <label>Address line 2<input maxLength={160} disabled={!canManage} value={String(profileDraft.addressLine2??'')} onChange={event=>updateProfile('addressLine2',event.target.value)}/></label>
          <label>City / town<input maxLength={100} disabled={!canManage} value={String(profileDraft.city??'')} onChange={event=>updateProfile('city',event.target.value)}/></label>
          <label>State<input maxLength={100} disabled={!canManage} value={String(profileDraft.state??'')} onChange={event=>updateProfile('state',event.target.value)}/></label>
          <label>Postal code<input maxLength={20} disabled={!canManage} value={String(profileDraft.postalCode??'')} onChange={event=>updateProfile('postalCode',event.target.value)}/></label>
        </div>
        <div className="business-form-footer"><span>Base currency: <strong>{business?.baseCurrency??'NGN'}</strong>. Currency changes are disabled to protect existing financial records.</span>{canManage&&<button className="primary" type="submit" disabled={savingProfile}>{savingProfile?'Saving…':'Save business profile'}</button>}</div>
      </form>
    </section>

    <section className="panel business-locations-panel">
      <div className="business-section-header"><div><span className="eyebrow">BRANCHES & WAREHOUSES</span><h2>Locations</h2><p>Create locations, update addresses and archive locations that are no longer operating. Historical transactions remain preserved.</p></div>{canManage&&<button type="button" className="primary" onClick={beginCreateLocation}>Add location</button>}</div>
      {activeLocations.length===0&&<div className="business-empty">There are no active locations yet. Create a branch or warehouse before recording stock, sales or expenses.</div>}
      <div className="business-location-list">
        {activeLocations.map(location=><article className="business-location-card" key={location.id}>
          <div className="business-location-main"><span className="business-location-icon" aria-hidden="true">{location.type==='warehouse'?'W':location.type==='region'?'R':'B'}</span><div><div className="business-location-title"><strong>{location.name}</strong><span className="business-location-status active">Active</span></div><small>{location.type}{location.code?' · '+location.code:''}{location.parentId?' · Parent: '+(activeLocations.find(item=>item.id===location.parentId)?.name??'Region'):''}</small><small>{[location.addressLine1,location.city,location.state].filter(Boolean).join(', ')||'Address not added'}</small></div></div>
          {canManage&&<div className="business-location-actions"><button type="button" className="secondary" onClick={()=>beginEditLocation(location)}>Edit</button><button type="button" className="text-btn danger" disabled={savingLocation||activeLocations.length<=1} onClick={()=>void changeLocationAvailability(location,'archive')}>Archive</button></div>}
        </article>)}
      </div>
      {archivedLocations.length>0&&<details className="business-archived"><summary>Archived locations ({archivedLocations.length})</summary><div className="business-location-list">{archivedLocations.map(location=><article className="business-location-card archived" key={location.id}><div className="business-location-main"><span className="business-location-icon" aria-hidden="true">A</span><div><div className="business-location-title"><strong>{location.name}</strong><span className="business-location-status archived">Archived</span></div><small>{location.type}{location.code?' · '+location.code:''}</small></div></div>{canManage&&<button type="button" className="secondary" disabled={savingLocation} onClick={()=>void changeLocationAvailability(location,'restore')}>Restore</button>}</article>)}</div></details>}
    </section>

    {showLocationForm&&<div className="business-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setShowLocationForm(false);}}>
      <section className="business-location-modal" role="dialog" aria-modal="true" aria-labelledby="business-location-title">
        <div className="business-modal-heading"><div><span className="eyebrow">{editingLocationId?'LOCATION DETAILS':'NEW LOCATION'}</span><h2 id="business-location-title">{editingLocationId?'Edit location':'Add a location'}</h2></div><button type="button" className="icon-btn" aria-label="Close location form" onClick={()=>setShowLocationForm(false)}>×</button></div>
        <form onSubmit={saveLocation}>
          <div className="business-form-grid">
            <label>Location name<input required maxLength={100} value={draft.name} onChange={event=>setDraft(previous=>({...previous,name:event.target.value}))}/></label>
            <label>Location type<select value={draft.type} onChange={event=>setDraft(previous=>({...previous,type:event.target.value as LocationDraft['type'],parentId:event.target.value==='region'?'':previous.parentId}))}><option value="branch">Branch</option><option value="warehouse">Warehouse</option><option value="region">Region</option></select></label>
            <label>Location code<input maxLength={20} value={draft.code} onChange={event=>setDraft(previous=>({...previous,code:event.target.value.toUpperCase()}))} placeholder="e.g. IKEJA-01"/></label>
            {draft.type!=='region'&&<label>Parent region<select value={draft.parentId} onChange={event=>setDraft(previous=>({...previous,parentId:event.target.value}))}><option value="">No parent region</option>{regions.filter(region=>region.id!==editingLocationId).map(region=><option key={region.id} value={region.id}>{region.name}</option>)}</select></label>}
            <label>Phone<input type="tel" maxLength={40} value={draft.phone} onChange={event=>setDraft(previous=>({...previous,phone:event.target.value}))}/></label>
            <label>Contact email<input type="email" maxLength={320} value={draft.contactEmail} onChange={event=>setDraft(previous=>({...previous,contactEmail:event.target.value}))}/></label>
            <label>Address line 1<input maxLength={160} value={draft.addressLine1} onChange={event=>setDraft(previous=>({...previous,addressLine1:event.target.value}))}/></label>
            <label>Address line 2<input maxLength={160} value={draft.addressLine2} onChange={event=>setDraft(previous=>({...previous,addressLine2:event.target.value}))}/></label>
            <label>City / town<input maxLength={100} value={draft.city} onChange={event=>setDraft(previous=>({...previous,city:event.target.value}))}/></label>
            <label>State<input maxLength={100} value={draft.state} onChange={event=>setDraft(previous=>({...previous,state:event.target.value}))}/></label>
            <label>Postal code<input maxLength={20} value={draft.postalCode} onChange={event=>setDraft(previous=>({...previous,postalCode:event.target.value}))}/></label>
          </div>
          <div className="business-modal-actions"><button type="button" className="secondary" onClick={()=>setShowLocationForm(false)}>Cancel</button><button className="primary" type="submit" disabled={savingLocation}>{savingLocation?'Saving…':editingLocationId?'Save changes':'Create location'}</button></div>
        </form>
      </section>
    </div>}
    {!canManage&&<p className="business-readonly-note">You can view the business profile and locations assigned to your role. Only business owners can change these records.</p>}
  </div>;
}
